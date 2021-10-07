const OracleCore = artifacts.require("OracleCore");
const Gatekeeper = artifacts.require("GateKeeper");
const OracleFacade = artifacts.require("OracleFacade");
const Insurance = artifacts.require("Insurance");
const Escrow = require("@openzeppelin/contracts/build/contracts/Escrow.json");
const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const expect = chai.expect;
const { ROLES_CONST, REGIONS_CONST, SEVERITY_CONST, SEASON_CONST, FARMS_CONST, CONST, CONTRACT_CONST, addBigNumbers, multiplyBigNumbers, divideBigNumbers, subBigNumbers, isEventFound, interfaceId, keccak256 } = require("./helper");
const {
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
} = require('@openzeppelin/test-helpers');



contract("Insurance", async (accounts) => {
    const owner = accounts[0];
    const admin = accounts[1];
    const insurer = accounts[2];
    const keeper = accounts[3];
    const government = accounts[4];
    const oracle = accounts[5];
    const farmers = accounts.slice(6, 11);
    let oracleCore, gateKeeper, escrowOracle, escrowInsurance, oracleFacade, insurance;
    let defaultAdminRoleId;
    let season = '2021';
    let oracleKeeperFee, insuranceKeeperFee;
    let premiumPerHA, halfPremiumPerHa;

    beforeEach(async () => {
        gateKeeper = await Gatekeeper.new({ from: owner });
        oracleCore = await OracleCore.new(gateKeeper.address, { from: owner });
        oracleFacade = await OracleFacade.new(oracleCore.address, { from: owner });
        insurance = await Insurance.new(gateKeeper.address, oracleFacade.address, { from: owner });

        escrowOracle = await new web3.eth.Contract(
            Escrow.abi,
            await oracleCore.getEscrow(),
        );
        escrowInsurance = await new web3.eth.Contract(
            Escrow.abi,
            await insurance.getEscrow(),
        );
        defaultAdminRoleId = await gateKeeper.DEFAULT_ADMIN_ROLE();
        await gateKeeper.addRole(ROLES_CONST.ADMIN_ROLE, defaultAdminRoleId, { from: owner });
        await gateKeeper.addAssignment(ROLES_CONST.ADMIN_ROLE, admin);
        // set roles
        await gateKeeper.addRole(ROLES_CONST.INSURER_ROLE, ROLES_CONST.ADMIN_ROLE, { from: admin });
        await gateKeeper.addRole(ROLES_CONST.GOVERNMENT_ROLE, ROLES_CONST.ADMIN_ROLE, { from: admin });
        await gateKeeper.addRole(ROLES_CONST.KEEPER_ROLE, ROLES_CONST.ADMIN_ROLE, { from: admin });
        await gateKeeper.addRole(ROLES_CONST.ORACLE_ROLE, ROLES_CONST.ADMIN_ROLE, { from: admin });
        await gateKeeper.addRole(ROLES_CONST.FARMER_ROLE, ROLES_CONST.ADMIN_ROLE, { from: admin });
        // assign roles
        await gateKeeper.addAssignment(ROLES_CONST.INSURER_ROLE, insurer, { from: admin });
        await gateKeeper.addAssignment(ROLES_CONST.GOVERNMENT_ROLE, government, { from: admin });
        await gateKeeper.addAssignment(ROLES_CONST.KEEPER_ROLE, keeper, { from: admin });
        await gateKeeper.addAssignment(ROLES_CONST.ORACLE_ROLE, oracle, { from: admin });
        for (let farmer of farmers) {
            await gateKeeper.addAssignment(ROLES_CONST.FARMER_ROLE, farmer, { from: admin });
        }
        oracleFee = await oracleCore.ORACLE_FEE();
        oracleKeeperFee = await oracleCore.KEEPER_FEE();
        insuranceKeeperFee = await insurance.KEEPER_FEE();
        premiumPerHA = await insurance.PERMIUM_PER_HA();
        halfPremiumPerHa = await insurance.HALF_PERMIUM_PER_HA();
    });

    describe("Check initial state", () => {

        it("Premium, totalOpenSize, totalOpenContracts , intial balance, minimal reuqired liquidity", async () => {
            let res = await insurance.getNumberClosedContracts(season, REGIONS_CONST.A);
            expect((await insurance.totalOpenSize()).toString(), `Initial total open size not correct`).to.equal('0');
            expect((await insurance.totalOpenContracts()).toString(), `Initial total open contracts not correct`).to.equal('0');
            expect((await insurance.PERMIUM_PER_HA()).toString(), `Premium per HA not correct`).to.equal(web3.utils.toWei('0.15', 'ether'));
            expect((await insurance.HALF_PERMIUM_PER_HA()).toString(), `Half Premium per HA not correct`).to.equal(web3.utils.toWei('0.075', 'ether'));
            expect((await insurance.getBalance()).toString(), `Contract balance not correct`).to.equal('0');
            expect((await insurance.minimumAmount()).toString(), `Minimum liquidity not correct`).to.equal('0');

        });


        it("Empty data for non existing contract", async () => {
            let res = await insurance.getContract(season, REGIONS_CONST.A, FARMS_CONST[1]);
            // farmID = 0x0
            expect(res[0], `key not correct`).to.equal(CONST.EMPTY_BYTES32);
            expect(res[1], `farmID not correct`).to.equal(CONST.EMPTY_BYTES32);
            expect(res[2].toString(), `Contract state not correct`).to.equal(CONTRACT_CONST.DEFAULT);
            expect(res[3], `insuree not correct`).to.equal(CONST.EMPTY_ADDRESS);
            expect(res[4], `government not correct`).to.equal(CONST.EMPTY_ADDRESS);
            expect(res[5], `insurer not correct`).to.equal(CONST.EMPTY_ADDRESS);
            expect(res[6].toString(), `size not correct`).to.equal('0');
            expect(res[7], `region not correct`).to.equal(CONST.EMPTY_BYTES32);
            expect(res[8].toString(), `season not correct`).to.equal('0');
            expect(res[9].toString(), `totalStaked not correct`).to.equal('0');
            expect(res[10].toString(), `compensation not correct`).to.equal('0');
        });

        it("0 number of closed contracts", async () => {
            let res = await insurance.getNumberClosedContracts(season, REGIONS_CONST.A);
            expect(res.toString(), `Number closed contracts not correct`).to.equal('0');
        });

        it("0 number of open contracts", async () => {
            let res = await insurance.getNumberOpenContracts(season, REGIONS_CONST.A);
            expect(res.toString(), `Number open contracts not correct`).to.equal('0');
        });

        it("Only an insurer can provide liquidity", async () => {
            await expectRevert((web3.eth.sendTransaction({
                from: owner,
                to: insurance.address,
                value: 1
            })), "Restricted to insurers.");

            await web3.eth.sendTransaction({
                from: insurer,
                to: insurance.address,
                value: 1
            }); // success
        });

    });

    describe("Register a contract", () => {
        it("Contract must be active", async () => {
            await insurance.switchContractOff({ from: owner });
            await expectRevert(insurance.register(season, REGIONS_CONST.A, FARMS_CONST[1], '10', { from: farmers[0], value: '1' }), "Contract is currently suspended.");
        });

        it("Must provide ETH", async () => {
            await expectRevert.unspecified(insurance.register(season, REGIONS_CONST.A, FARMS_CONST[1], '10', { from: farmers[0] }));

        });

        it("Only farmer", async () => {
            await expectRevert(insurance.register(season, REGIONS_CONST.A, FARMS_CONST[1], '10', { from: insurer, value: '1' }), "Restricted to farmers.");

        });

        it("Season must be open", async () => {
            await expectRevert(insurance.register(season, REGIONS_CONST.A, FARMS_CONST[1], '10', { from: farmers[0], value: '1' }), "Season must be open.");

        });

        it("Cover for half of the premium", async () => {
            await (web3.eth.sendTransaction({
                from: insurer,
                to: oracleCore.address,
                value: web3.utils.toWei('10', 'ether')
            }));
            await oracleCore.openSeason(season, { from: keeper });
            await expectRevert(insurance.register(season, REGIONS_CONST.A, FARMS_CONST[1], '10', { from: farmers[0], value: '1' }), "Not enough money to pay for premium");

        });

        it("Minimum must be covered", async () => {
            await (web3.eth.sendTransaction({
                from: insurer,
                to: oracleCore.address,
                value: web3.utils.toWei('10', 'ether')
            }));
            const ha = '10'
            await oracleCore.openSeason(season, { from: keeper });
            const amount = multiplyBigNumbers(halfPremiumPerHa, ha);
            await expectRevert(insurance.register(season, REGIONS_CONST.A, FARMS_CONST[1], '10', { from: farmers[0], value: amount }), "Not enough balance staked in the contract");

        });

        it("Check for duplicates", async () => {

            await (web3.eth.sendTransaction({
                from: insurer,
                to: oracleCore.address,
                value: web3.utils.toWei('10', 'ether')
            }));

            await (web3.eth.sendTransaction({
                from: insurer,
                to: insurance.address,
                value: web3.utils.toWei('10', 'ether')
            }));

            const ha = '10'
            await oracleCore.openSeason(season, { from: keeper });
            const amount = multiplyBigNumbers(halfPremiumPerHa, ha);
            await insurance.register(season, REGIONS_CONST.A, FARMS_CONST[1], '10', { from: farmers[0], value: amount });
            await expectRevert(insurance.register(season, REGIONS_CONST.A, FARMS_CONST[1], '10', { from: farmers[0], value: amount }), "Duplicate");

        });
        it("Registration , data correct", async () => {
            await (web3.eth.sendTransaction({
                from: insurer,
                to: oracleCore.address,
                value: web3.utils.toWei('10', 'ether')
            }));

            await (web3.eth.sendTransaction({
                from: insurer,
                to: insurance.address,
                value: web3.utils.toWei('10', 'ether')
            }));

            const ha = '10', size = '10';
            await oracleCore.openSeason(season, { from: keeper });
            const amount = multiplyBigNumbers(halfPremiumPerHa, ha);
            let contractKey = await insurance.getContractKey(season, REGIONS_CONST.A, FARMS_CONST[1]);

            // balance account before registration
            let balanceBefore = await web3.eth.getBalance(farmers[0]);
            let trans = await insurance.register(season, REGIONS_CONST.A, FARMS_CONST[1], size, { from: farmers[0], value: addBigNumbers('10', amount), gasPrice: 0, });

            // check events
            expectEvent(trans, 'InsuranceRequested', { season: season, region: REGIONS_CONST.A, farmID: FARMS_CONST[1], size: size, fee: amount, farmer: farmers[0], key: contractKey });

            // check data
            let res = await insurance.getContract(season, REGIONS_CONST.A, FARMS_CONST[1]);
            expect(res[0], `key not correct`).to.equal(contractKey);
            expect(res[1], `farmID not correct`).to.equal(FARMS_CONST[1]);
            expect(res[2].toString(), `Contract state not correct`).to.equal(CONTRACT_CONST.REGISTERED);
            expect(res[3], `insuree not correct`).to.equal(farmers[0]);
            expect(res[4], `government not correct`).to.equal(CONST.EMPTY_ADDRESS);
            expect(res[5], `insurer not correct`).to.equal(CONST.EMPTY_ADDRESS);
            expect(res[6].toString(), `size not correct`).to.equal(size);
            expect(res[7], `region not correct`).to.equal(REGIONS_CONST.A);
            expect(res[8].toString(), `season not correct`).to.equal(season);
            expect(res[9].toString(), `totalStaked not correct`).to.equal(amount.toString());
            expect(res[10].toString(), `compensation not correct`).to.equal('0');

            // check number open contracts
            let numContracts = await insurance.getNumberOpenContracts(season, REGIONS_CONST.A);
            expect(numContracts.toString(), `Number open contracts not correct`).to.equal('1');

            let elemAt = await insurance.getOpenContractsAt(season, REGIONS_CONST.A, '0');
            expect(elemAt, `Wrong element in open contracts array`).to.equal(contractKey);

            numContracts = await insurance.getNumberClosedContracts(season, REGIONS_CONST.A);
            expect(numContracts.toString(), `Number closed contracts not correct`).to.equal('0');

            // check total open sze and total surface
            let totalOpenSize = await insurance.totalOpenSize();
            let totalOpenContracts = await insurance.totalOpenContracts();
            expect(totalOpenSize.toString(), `Initial total open size not correct`).to.equal(size);
            expect(totalOpenContracts.toString(), `Initial total open contracts not correct`).to.equal('1');

            // check minimum amount = 1open contract*keeper_fee + total size * 2.5(D4)*premium
            let expected = addBigNumbers(multiplyBigNumbers(insuranceKeeperFee, totalOpenContracts), divideBigNumbers(multiplyBigNumbers(size, multiplyBigNumbers(premiumPerHA, '25')), '10'));
            expect((await insurance.minimumAmount()).toString(), `Minimum liquidity not correct`).to.equal(expected.toString());

            // get change back
            let balanceAfter = await web3.eth.getBalance(farmers[0]);
            expect((addBigNumbers(balanceAfter, amount)).toString(), "Balance not correct").to.equal(balanceBefore.toString());

        });


    })

    describe("Validate a registered contract", () => {
        const ha = '10', size = '10';
        let contractKey;
        let amount;
        beforeEach(async () => {
            await (web3.eth.sendTransaction({
                from: insurer,
                to: oracleCore.address,
                value: web3.utils.toWei('10', 'ether')
            }));

            await (web3.eth.sendTransaction({
                from: insurer,
                to: insurance.address,
                value: web3.utils.toWei('10', 'ether')
            }));
            await oracleCore.openSeason(season, { from: keeper });
            amount = multiplyBigNumbers(halfPremiumPerHa, ha);
            contractKey = await insurance.getContractKey(season, REGIONS_CONST.A, FARMS_CONST[1]);
            await insurance.register(season, REGIONS_CONST.A, FARMS_CONST[1], size, { from: farmers[0], value: addBigNumbers('10', amount) });

        });

        it("Contract must be active", async () => {
            await insurance.switchContractOff({ from: owner });
            await expectRevert(insurance.validate(season, REGIONS_CONST.A, FARMS_CONST[1], { from: government, value: '1' }), "Contract is currently suspended.");
        });

        it("Must provide ETH", async () => {
            await expectRevert.unspecified(insurance.validate(season, REGIONS_CONST.A, FARMS_CONST[1], { from: government }));

        });

        it("Only government", async () => {
            await expectRevert(insurance.validate(season, REGIONS_CONST.A, FARMS_CONST[1], { from: insurer, value: '1' }), "Restricted to government.");

        });

        it("Season must be open", async () => {
            await expectRevert(insurance.validate('2022', REGIONS_CONST.A, FARMS_CONST[1], { from: government, value: '1' }), "Season must be open.");

        });

        it("Contract must exist", async () => {

            await expectRevert(insurance.validate(season, REGIONS_CONST.A, FARMS_CONST[2], { from: government, value: '1' }), "Contract do not exist");

        });

        it("Cover for half of the premium", async () => {
            await expectRevert(insurance.validate(season, REGIONS_CONST.A, FARMS_CONST[1], { from: government, value: '1' }), "Not enough money to pay for premium");

        });

        it("Cannot validate twice", async () => {
            await insurance.validate(season, REGIONS_CONST.A, FARMS_CONST[1], { from: government, value: amount });
            await expectRevert(insurance.validate(season, REGIONS_CONST.A, FARMS_CONST[1], { from: government, value: amount }), "Contract must be in registered state");

        });

        it("Check data and events", async () => {
            let balanceBefore = await web3.eth.getBalance(government);
            let trans = await insurance.validate(season, REGIONS_CONST.A, FARMS_CONST[1], { from: government, value: amount, gasPrice: 0 });

            // check events
            expectEvent(trans, 'InsuranceValidated', { season: season, region: REGIONS_CONST.A, farmID: FARMS_CONST[1], totalStaked: multiplyBigNumbers(amount, '2').toString(), government: government, key: contractKey });

            // check data
            let res = await insurance.getContract(season, REGIONS_CONST.A, FARMS_CONST[1]);
            expect(res[0], `key not correct`).to.equal(contractKey);
            expect(res[1], `farmID not correct`).to.equal(FARMS_CONST[1]);
            expect(res[2].toString(), `Contract state not correct`).to.equal(CONTRACT_CONST.VALIDATED);
            expect(res[3], `insuree not correct`).to.equal(farmers[0]);
            expect(res[4], `government not correct`).to.equal(government);
            expect(res[5], `insurer not correct`).to.equal(CONST.EMPTY_ADDRESS);
            expect(res[6].toString(), `size not correct`).to.equal(size);
            expect(res[7], `region not correct`).to.equal(REGIONS_CONST.A);
            expect(res[8].toString(), `season not correct`).to.equal(season);
            expect(res[9].toString(), `totalStaked not correct`).to.equal(multiplyBigNumbers(amount, '2').toString());
            expect(res[10].toString(), `compensation not correct`).to.equal('0');

            // check number open contracts
            let numContracts = await insurance.getNumberOpenContracts(season, REGIONS_CONST.A);
            expect(numContracts.toString(), `Number open contracts not correct`).to.equal('1');

            let elemAt = await insurance.getOpenContractsAt(season, REGIONS_CONST.A, '0');
            expect(elemAt, `Wrong element in open contracts array`).to.equal(contractKey);

            numContracts = await insurance.getNumberClosedContracts(season, REGIONS_CONST.A);
            expect(numContracts.toString(), `Number closed contracts not correct`).to.equal('0');

            // check total open sze and total surface
            let totalOpenSize = await insurance.totalOpenSize();
            let totalOpenContracts = await insurance.totalOpenContracts();
            expect(totalOpenSize.toString(), `Initial total open size not correct`).to.equal(size);
            expect(totalOpenContracts.toString(), `Initial total open contracts not correct`).to.equal('1');

            // check minimum amount = 1open contract*keeper_fee + total size * 2.5(D4)*premium
            let expected = addBigNumbers(multiplyBigNumbers(insuranceKeeperFee, totalOpenContracts), divideBigNumbers(multiplyBigNumbers(size, multiplyBigNumbers(premiumPerHA, '25')), '10'));
            expect((await insurance.minimumAmount()).toString(), `Minimum liquidity not correct`).to.equal(expected.toString());

            // get change back
            let balanceAfter = await web3.eth.getBalance(government);
            expect((addBigNumbers(balanceAfter, amount)).toString(), "Balance not correct").to.equal(balanceBefore.toString());


        });

    });

    describe("Activate a validated contract", () => {
        const ha = '10', size = '10';
        let contractKey;
        let amount;
        beforeEach(async () => {
            await (web3.eth.sendTransaction({
                from: insurer,
                to: oracleCore.address,
                value: web3.utils.toWei('10', 'ether')
            }));

            await (web3.eth.sendTransaction({
                from: insurer,
                to: insurance.address,
                value: web3.utils.toWei('10', 'ether')
            }));
            await oracleCore.openSeason(season, { from: keeper });
            amount = multiplyBigNumbers(halfPremiumPerHa, ha);
            contractKey = await insurance.getContractKey(season, REGIONS_CONST.A, FARMS_CONST[1]);
            await insurance.register(season, REGIONS_CONST.A, FARMS_CONST[1], size, { from: farmers[0], value: addBigNumbers('10', amount) });
            await insurance.validate(season, REGIONS_CONST.A, FARMS_CONST[1], { from: government, value: amount });

        });

        it("Contract must be active", async () => {
            await insurance.switchContractOff({ from: owner });
            await expectRevert(insurance.activate(season, REGIONS_CONST.A, FARMS_CONST[1], { from: insurer }), "Contract is currently suspended.");
        });


        it("Only insurer", async () => {
            await expectRevert(insurance.activate(season, REGIONS_CONST.A, FARMS_CONST[1], { from: government }), "Restricted to insurers.");

        });

        it("Season must be open", async () => {
            await expectRevert(insurance.activate('2022', REGIONS_CONST.A, FARMS_CONST[1], { from: insurer }), "Season must be open.");

        });

        it("Contract must exist", async () => {

            await expectRevert(insurance.activate(season, REGIONS_CONST.A, FARMS_CONST[2], { from: insurer }), "Contract do not exist");

        });

        it("Cannot activate twice", async () => {
            await insurance.activate(season, REGIONS_CONST.A, FARMS_CONST[1], { from: insurer });
            await expectRevert(insurance.activate(season, REGIONS_CONST.A, FARMS_CONST[1], { from: insurer }), "Contract must be in validated state");

        });

        it("Check data and events", async () => {
            let trans = await insurance.activate(season, REGIONS_CONST.A, FARMS_CONST[1], { from: insurer });

            // check events
            expectEvent(trans, 'InsuranceActivated', { season: season, region: REGIONS_CONST.A, farmID: FARMS_CONST[1], insurer: insurer, key: contractKey });
            // check data
            let res = await insurance.getContract(season, REGIONS_CONST.A, FARMS_CONST[1]);
            expect(res[0], `key not correct`).to.equal(contractKey);
            expect(res[1], `farmID not correct`).to.equal(FARMS_CONST[1]);
            expect(res[2].toString(), `Contract state not correct`).to.equal(CONTRACT_CONST.INSURED);
            expect(res[3], `insuree not correct`).to.equal(farmers[0]);
            expect(res[4], `government not correct`).to.equal(government);
            expect(res[5], `insurer not correct`).to.equal(insurer);
            expect(res[6].toString(), `size not correct`).to.equal(size);
            expect(res[7], `region not correct`).to.equal(REGIONS_CONST.A);
            expect(res[8].toString(), `season not correct`).to.equal(season);
            expect(res[9].toString(), `totalStaked not correct`).to.equal(multiplyBigNumbers(amount, '2').toString());
            expect(res[10].toString(), `compensation not correct`).to.equal('0');

            // check number open contracts
            let numContracts = await insurance.getNumberOpenContracts(season, REGIONS_CONST.A);
            expect(numContracts.toString(), `Number open contracts not correct`).to.equal('1');

            let elemAt = await insurance.getOpenContractsAt(season, REGIONS_CONST.A, '0');
            expect(elemAt, `Wrong element in open contracts array`).to.equal(contractKey);

            numContracts = await insurance.getNumberClosedContracts(season, REGIONS_CONST.A);
            expect(numContracts.toString(), `Number closed contracts not correct`).to.equal('0');

            // check total open sze and total surface
            let totalOpenSize = await insurance.totalOpenSize();
            let totalOpenContracts = await insurance.totalOpenContracts();
            expect(totalOpenSize.toString(), `Initial total open size not correct`).to.equal(size);
            expect(totalOpenContracts.toString(), `Initial total open contracts not correct`).to.equal('1');

            // check minimum amount = 1open contract*keeper_fee + total size * 2.5(D4)*premium
            let expected = addBigNumbers(multiplyBigNumbers(insuranceKeeperFee, totalOpenContracts), divideBigNumbers(multiplyBigNumbers(size, multiplyBigNumbers(premiumPerHA, '25')), '10'));
            expect((await insurance.minimumAmount()).toString(), `Minimum liquidity not correct`).to.equal(expected.toString());
        });

    });


});