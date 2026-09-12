// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ColdRegistry
 * @notice Minimal on-chain registry for Coldcoin network metadata.
 *         Native currency is COLD (genesis alloc). This contract only
 *         stores public network parameters for wallets / explorers.
 */
contract ColdRegistry {
    string public constant name = "Coldcoin";
    string public constant symbol = "COLD";
    uint256 public immutable chainId;
    address public owner;
    string public rpcUrl;
    string public wsUrl;
    string public website;

    event MetaUpdated(string rpcUrl, string wsUrl, string website);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(uint256 chainId_, string memory rpcUrl_, string memory wsUrl_, string memory website_) {
        owner = msg.sender;
        chainId = chainId_;
        rpcUrl = rpcUrl_;
        wsUrl = wsUrl_;
        website = website_;
    }

    function setMeta(string calldata rpcUrl_, string calldata wsUrl_, string calldata website_) external onlyOwner {
        rpcUrl = rpcUrl_;
        wsUrl = wsUrl_;
        website = website_;
        emit MetaUpdated(rpcUrl_, wsUrl_, website_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
